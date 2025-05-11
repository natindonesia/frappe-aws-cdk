import * as cdk from 'aws-cdk-lib';
import { aws_logs, Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface ServiceStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  cluster: ecs.Cluster;
  database: rds.DatabaseCluster;
  redis: ec2.Instance;
  sitesFs: efs.FileSystem;
  logsFs: efs.FileSystem;
  publicAlbListener: elbv2.ApplicationListener;
  backendAlb: elbv2.ApplicationLoadBalancer;
  backendAlbListener: elbv2.ApplicationListener;
  frontendTargetGroup: elbv2.ApplicationTargetGroup;
  socketIoTargetGroup: elbv2.ApplicationTargetGroup;
  backendTargetGroup: elbv2.ApplicationTargetGroup;
  frontendServiceSecurityGroup: ec2.SecurityGroup;
  socketIoServiceSecurityGroup: ec2.SecurityGroup;
  backendServiceSecurityGroup: ec2.SecurityGroup;
  commonServiceSecurityGroup: ec2.SecurityGroup;
  ecrImage: string;
}

export class ServiceStack extends cdk.NestedStack  {
  private readonly sitesAccessPoint: efs.AccessPoint;
  private readonly logsAccessPoint: efs.AccessPoint;
  private readonly image: ecs.ContainerImage;
  taskRole: cdk.aws_iam.Role;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    this.sitesAccessPoint = props.sitesFs.addAccessPoint('SitesAccess', {
      path: '/sites',
      posixUser: { uid: '1000', gid: '1000' },
    });

    this.logsAccessPoint = props.logsFs.addAccessPoint('LogsAccess', {
      path: '/logs',
      posixUser: { uid: '1000', gid: '1000' },
    });

    this.image = ecs.ContainerImage.fromRegistry(props.ecrImage);

    
    // Create IAM Role for ECS Tasks
    // Create IAM Role for ECS Tasks
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonElasticFileSystemClientReadWriteAccess'),
      ],
    });

    // Add EFS permissions
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'elasticfilesystem:ClientRootAccess',
        'elasticfilesystem:ClientWrite',
        'elasticfilesystem:ClientMount'
      ],
      resources: [
        props.sitesFs.fileSystemArn,
        props.logsFs.fileSystemArn,
      ],
    }));

    // Add Secrets Manager permissions
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret'
      ],
      resources: [props.database.secret!.secretArn],
    }));

    // Add ECR permissions
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage'
      ],
      resources: ['*'],
    }));
    this.taskRole = taskRole;
    this.createEcsServices(props);
  }

  private createTaskDefinition(id: string): ecs.FargateTaskDefinition {
    // Create execution role with ECR permissions
    const executionRole = new iam.Role(this, `${id}ExecutionRole`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
      ],
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, id, {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole: executionRole,
      taskRole: this.taskRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    taskDefinition.addVolume({
      name: 'sites',
      efsVolumeConfiguration: {
        fileSystemId: this.sitesAccessPoint.fileSystem.fileSystemId,
        authorizationConfig: {
          accessPointId: this.sitesAccessPoint.accessPointId,
          iam: 'ENABLED'
        },
        transitEncryption: 'ENABLED',
      },
    });

    taskDefinition.addVolume({
      name: 'logs',
      efsVolumeConfiguration: {
        fileSystemId: this.logsAccessPoint.fileSystem.fileSystemId,
        authorizationConfig: {
          accessPointId: this.logsAccessPoint.accessPointId,
          iam: 'ENABLED'
        },
        transitEncryption: 'ENABLED',
      },
    });

    return taskDefinition;
  }

  private setServiceScaling(service: ecs.FargateService) {
    const scaling = service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 2,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.minutes(5),
      scaleOutCooldown: Duration.minutes(2),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: Duration.minutes(5),
      scaleOutCooldown: Duration.minutes(2),
    });
  }

  private createEcsServices(props: ServiceStackProps) {
    const commonContainerEnvironments = {
      DB_HOST: props.database.clusterEndpoint.hostname,
      DB_PORT: props.database.clusterEndpoint.port.toString(),
      REDIS_CACHE: props.redis.instancePrivateIp + ':6379',
      REDIS_QUEUE: props.redis.instancePrivateIp + ':6379',
      SOCKETIO_PORT: '9000',
      MYSQL_ROOT_PASSWORD: props.database.secret?.secretValueFromJson('password').unsafeUnwrap(),
      MYSQL_ROOT_USERNAME: props.database.secret?.secretValueFromJson('username').unsafeUnwrap(),
      MARIA_DB_ROOT_PASSWORD: props.database.secret?.secretValueFromJson('password').unsafeUnwrap(),
    } as Record<string, string>;

    // Backend Service
    const backendTaskDef = this.createTaskDefinition('BackendTaskDef');
    const backendContainer = backendTaskDef.addContainer('Backend', {
      image: this.image,
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'backend',
        logRetention: aws_logs.RetentionDays.ONE_WEEK
      }),
      healthCheck: {
        command: [
          'CMD-SHELL',
          'curl -f http://localhost:8000/api/method/ping || exit 1'
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      portMappings: [
        {
          containerPort: 8000,
          hostPort: 8000,
          protocol: ecs.Protocol.TCP,
        },
      ],
    });

    const backendService = new ecs.FargateService(this, 'BackendService', {
      cluster: props.cluster,
      taskDefinition: backendTaskDef,
      desiredCount: 1,
      securityGroups: [
        props.backendServiceSecurityGroup,
        props.commonServiceSecurityGroup
      ],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    this.setServiceScaling(backendService);

    // Add backend service to target group
    props.backendTargetGroup.addTarget(backendService.loadBalancerTarget({
      containerName: 'Backend',
      containerPort: 8000,
    }));

    // Frontend Service
    const frontendTaskDef = this.createTaskDefinition('FrontendTaskDef');
    const frontendContainer = frontendTaskDef.addContainer('Frontend', {
      image: this.image,
      entryPoint: ['bash', '-c', 'nginx-entrypoint.sh'],
      environment: {
        BACKEND: props.backendAlb.loadBalancerDnsName + ':8000',
        SOCKETIO: 'websocket:9000',
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'frontend',
        logRetention: aws_logs.RetentionDays.ONE_WEEK
      }),
      healthCheck: {
        command: [
          'CMD-SHELL',
          'curl -f http://localhost:8080/ || exit 1'
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      portMappings: [{
        containerPort: 8080,
        hostPort: 8080,
        protocol: ecs.Protocol.TCP,
      }],
    });

    const frontendService = new ecs.FargateService(this, 'FrontendService', {
      cluster: props.cluster,
      taskDefinition: frontendTaskDef,
      desiredCount: 1,
      securityGroups: [
        props.frontendServiceSecurityGroup,
        props.commonServiceSecurityGroup
      ],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    this.setServiceScaling(frontendService);

    // Add frontend service to target group
    props.frontendTargetGroup.addTarget(frontendService.loadBalancerTarget({
      containerName: 'Frontend',
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    }));

    // Socket.IO Service
    const socketIoTaskDef = this.createTaskDefinition('SocketIoTaskDef');
    const socketIoContainer = socketIoTaskDef.addContainer('SocketIo', {
      image: this.image,
      command: ['node', '/home/frappe/frappe-bench/apps/frappe/socketio.js'],
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'socketio',
        logRetention: aws_logs.RetentionDays.ONE_WEEK
      }),
      healthCheck: {
        command: [
          'CMD-SHELL',
          'curl -f http://localhost:9000/socket.io/health || exit 1'
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      portMappings: [{
        containerPort: 9000,
        hostPort: 9000,
        protocol: ecs.Protocol.TCP,
      }],
    });

    const socketIoService = new ecs.FargateService(this, 'SocketIoService', {
      cluster: props.cluster,
      taskDefinition: socketIoTaskDef,
      desiredCount: 1,
      securityGroups: [
        props.socketIoServiceSecurityGroup,
        props.commonServiceSecurityGroup
      ],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    this.setServiceScaling(socketIoService);

    // Add socket.io service to target group
    props.socketIoTargetGroup.addTarget(socketIoService.loadBalancerTarget({
      containerName: 'SocketIo',
      containerPort: 9000,
      protocol: ecs.Protocol.TCP,
    }));

    // Add container mounts and environment variables
    [backendContainer, socketIoContainer, frontendContainer].forEach((container: ecs.ContainerDefinition) => {
      container.addMountPoints(
        {
          sourceVolume: 'sites',
          containerPath: '/home/frappe/frappe-bench/sites',
          readOnly: false,
        },
        {
          sourceVolume: 'logs',
          containerPath: '/home/frappe/frappe-bench/logs',
          readOnly: false,
        }
      );
      
      for (const [key, value] of Object.entries(commonContainerEnvironments)) {
        container.addEnvironment(key, value);
      }
    });

  }
}