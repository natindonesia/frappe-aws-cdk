import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  databaseSecurityGroup: ec2.SecurityGroup;
  redisSecurityGroup: ec2.SecurityGroup;
}

export class DatabaseStack extends cdk.NestedStack {
  public readonly database: rds.DatabaseCluster;
  public readonly redis: ec2.Instance;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // Create Aurora Serverless v2 cluster
    this.database = new rds.DatabaseCluster(this, 'MainDatabase', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_1
      }),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromGeneratedSecret('admin'),
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 1,
      storageEncrypted: true,
      backup: {
        retention: Duration.days(7),
        preferredWindow: '19:00-20:00',
      },
      monitoringInterval: Duration.seconds(60),
      writer: rds.ClusterInstance.serverlessV2('writer'),
      securityGroups: [props.databaseSecurityGroup],
    });

    // Create Redis Instance
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
        'yum update -y',
        'dnf install -y redis6',
        'systemctl enable redis6.service',
        'systemctl start redis6.service',
        'redis6-cli ping',
        'sed -i "s/bind 127.0.0.1/bind 0.0.0.0/" /etc/redis6/redis6.conf',
        'sed -i "s/# maxmemory <bytes>/maxmemory 1gb/" /etc/redis6/redis6.conf',
        'sed -i "s/# maxmemory-policy noeviction/maxmemory-policy allkeys-lru/" /etc/redis6/redis6.conf',
        'systemctl restart redis6.service',
        'redis6-cli ping',
    );

    this.redis = new ec2.Instance(this, 'RedisNode', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64
      }),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: props.redisSecurityGroup,
      keyPair: ec2.KeyPair.fromKeyPairName(this, 'KeyPair', 'YSA'),
      userData: userData,
    });
  }
}