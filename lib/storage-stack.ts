import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  efsSecurityGroup: ec2.SecurityGroup;
}

export class StorageStack extends cdk.NestedStack {
  public readonly sitesFs: efs.FileSystem;
  public readonly logsFs: efs.FileSystem;
  public readonly sitesAccessPoint: efs.AccessPoint;
  public readonly logsAccessPoint: efs.AccessPoint;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // Create Sites FileSystem
    this.sitesFs = new efs.FileSystem(this, 'SitesFs', {
      vpc: props.vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      throughputMode: efs.ThroughputMode.ELASTIC,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      securityGroup: props.efsSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
    });

    // Create Logs FileSystem
    this.logsFs = new efs.FileSystem(this, 'LogsFs', {
      vpc: props.vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
      throughputMode: efs.ThroughputMode.ELASTIC,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      securityGroup: props.efsSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
    });

  }
}