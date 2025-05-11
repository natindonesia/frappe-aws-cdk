import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface NetworkStackProps extends cdk.StackProps {
  maxAzs?: number;
}

export class NetworkStack extends cdk.NestedStack {
  public vpc: ec2.Vpc;
  public publicLoadBalancerSecurityGroup: ec2.SecurityGroup;
  public backendLoadBalancerSecurityGroup: ec2.SecurityGroup;
  public commonServiceSecurityGroup: ec2.SecurityGroup;
  public backendServiceSecurityGroup: ec2.SecurityGroup;
  public socketIoServiceSecurityGroup: ec2.SecurityGroup;
  public frontendServiceSecurityGroup: ec2.SecurityGroup;
  public redisSecurityGroup: ec2.SecurityGroup;
  public databaseSecurityGroup: ec2.SecurityGroup;
  public efsSecurityGroup: ec2.SecurityGroup;
  public natSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: NetworkStackProps) {
    super(scope, id, props);

    // Create VPC with NAT Instance
    this.vpc = this.createVpcWithNatInstance();

    // Configure Security Groups
    this.configureSecurityGroups();
  }

  private createVpcWithNatInstance(): ec2.Vpc {
    const natGatewayProvider = ec2.NatProvider.instanceV2({
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      machineImage: new ec2.LookupMachineImage({
        name: 'fck-nat-al2023-*-arm64-ebs',
        owners: ['568608671756'],
      }),
      keyPair: ec2.KeyPair.fromKeyPairName(this, 'KeyPair', 'YSA'),
    });

    const vpc = new ec2.Vpc(this, 'MainVpc', {
      maxAzs: 2,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      natGatewayProvider: natGatewayProvider,
      subnetConfiguration: [
        {
          name: 'Frontend',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Backend',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 20,
        },
        {
          name: 'Other',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 20,
        },
      ],
    });

    const natSecurityGroup = new ec2.SecurityGroup(this, 'NatSecurityGroup', {
      vpc,
      description: 'Security group for NAT instance',
    });
    
    natSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic());
    natSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTraffic());
    
    for (const gatewayInstance of natGatewayProvider.gatewayInstances) {
      gatewayInstance.addSecurityGroup(natSecurityGroup);
    }

    this.natSecurityGroup = natSecurityGroup;

    return vpc;
  }

  private configureSecurityGroups() {
    // Public ALB Security Group
    this.publicLoadBalancerSecurityGroup = new ec2.SecurityGroup(this, 'PublicLoadBalancerSecurityGroup', {
      vpc: this.vpc,
      allowAllOutbound: true,
      description: 'Allow http and https IPv4/IPv6 from anywhere',
      securityGroupName: 'LoadBalancerSecurityGroup',
    });
    
    this.publicLoadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
    this.publicLoadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));
    this.publicLoadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.tcp(80));
    this.publicLoadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.tcp(443));
    this.publicLoadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.icmpPing());
    this.publicLoadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.icmpPing());

    // Backend ALB Security Group
    this.backendLoadBalancerSecurityGroup = new ec2.SecurityGroup(this, 'BackendLoadBalancerSecurityGroup', {
      vpc: this.vpc,
      description: 'Allow http 8000 from Frontend',
      securityGroupName: 'BackendLoadBalancerSecurityGroup',
    });

    // Service Security Groups
    this.frontendServiceSecurityGroup = new ec2.SecurityGroup(this, 'FrontendServiceSecurityGroup', {
      vpc: this.vpc,
      description: 'Backend ALB (8000 TCP) to Frontend (8080 TCP) to Public ALB',
      securityGroupName: 'FrontendServiceSecurityGroup',
    });

    this.socketIoServiceSecurityGroup = new ec2.SecurityGroup(this, 'SocketIoServiceSecurityGroup', {
      vpc: this.vpc,
      description: 'Allow 9000 TCP from Public ALB',
      securityGroupName: 'SocketIoServiceSecurityGroup',
    });

    this.backendServiceSecurityGroup = new ec2.SecurityGroup(this, 'BackendServiceSecurityGroup', {
      vpc: this.vpc,
      description: 'Backend to Internal ALB',
      securityGroupName: 'BackendServiceSecurityGroup',
      allowAllOutbound: true,
    });

    this.commonServiceSecurityGroup = new ec2.SecurityGroup(this, 'CommonServiceSecurityGroup', {
      vpc: this.vpc,
      description: 'Common service security group to access Redis, EFS, DB',
      allowAllOutbound: true,
      securityGroupName: 'CommonServiceSecurityGroup',
    });

    // Database, Redis, and EFS Security Groups
    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'Allow MySQL from Common Service',
      securityGroupName: 'DatabaseSecurityGroup',
    });

    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      description: 'Allow Redis from Common Service',
      securityGroupName: 'RedisSecurityGroup',
    });

    this.efsSecurityGroup = new ec2.SecurityGroup(this, 'EFSSecurityGroup', {
      vpc: this.vpc,
      description: 'Allow EFS from Common Service',
      securityGroupName: 'EFSSecurityGroup',
    });

    // Configure Security Group Rules
    this.backendLoadBalancerSecurityGroup.addIngressRule(
      this.frontendServiceSecurityGroup,
      ec2.Port.tcp(8000),
      'Allow http 8000 from Frontend'
    );

    this.frontendServiceSecurityGroup.addIngressRule(
      this.publicLoadBalancerSecurityGroup,
      ec2.Port.tcp(8080),
      'Allow http 8080 from Public ALB'
    );

    this.socketIoServiceSecurityGroup.addIngressRule(
      this.publicLoadBalancerSecurityGroup,
      ec2.Port.tcp(9000),
      'Allow http 9000 from Public ALB'
    );

    this.backendServiceSecurityGroup.addIngressRule(
      this.backendLoadBalancerSecurityGroup,
      ec2.Port.tcp(8000),
      'Allow http 8000 from Backend ALB'
    );

    this.redisSecurityGroup.addIngressRule(
      this.commonServiceSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow Redis from Common Service'
    );

    this.redisSecurityGroup.addIngressRule(
        this.natSecurityGroup,
        ec2.Port.tcp(22),
        'Allow SSH from NAT Security Group'
    )

    this.databaseSecurityGroup.addIngressRule(
      this.commonServiceSecurityGroup,
      ec2.Port.tcp(3306),
      'Allow MySQL from Common Service'
    );

    this.efsSecurityGroup.addIngressRule(
      this.commonServiceSecurityGroup,
      ec2.Port.tcp(2049),
      'Allow EFS from Common Service'
    );
  }
}