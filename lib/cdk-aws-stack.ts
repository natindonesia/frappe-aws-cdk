import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';
import { DatabaseStack } from './database-stack';
import { StorageStack } from './storage-stack';
import { LoadBalancerStack } from './loadbalancer-stack';
import { ComputeStack } from './compute-stack';
import { ServiceStack } from './service-stack';

export class CdkAwsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    
  }
}
