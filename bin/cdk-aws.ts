#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkAwsStack } from '../lib/cdk-aws-stack';
import {NetworkStack} from "../lib/network-stack";
import {DatabaseStack} from "../lib/database-stack";
import {StorageStack} from "../lib/storage-stack";
import {LoadBalancerStack} from "../lib/loadbalancer-stack";
import {ComputeStack} from "../lib/compute-stack";
import {ServiceStack} from "../lib/service-stack";

const app = new cdk.App();

// Get stacks to deploy from context (cdk.json) or command line arguments
// Example usage:
// Deploy all stacks:
//   cdk deploy
// Deploy specific stacks:
//   cdk deploy -c stacks=NetworkStack,DatabaseStack
//   cdk deploy -c stacks=Network*
const stacksToDeployStr = app.node.tryGetContext('stacks');
const props = {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
} as cdk.StackProps;
const mainStack = new CdkAwsStack(app, 'FayolexCdkAwsStack', props);
// 1. Network Infrastructure
const networkStack = new NetworkStack(mainStack, 'NetworkStack', props);


// 2. Database Layer
const databaseStack = new DatabaseStack(mainStack, 'DatabaseStack', {
    ...props,
    vpc: networkStack.vpc,
    databaseSecurityGroup: networkStack.databaseSecurityGroup,
    redisSecurityGroup: networkStack.redisSecurityGroup,
});

// 3. Storage Layer
const storageStack = new StorageStack(mainStack, 'StorageStack', {
    ...props,
    vpc: networkStack.vpc,
    efsSecurityGroup: networkStack.efsSecurityGroup,
});

// 4. Load Balancer Layer
const loadBalancerStack = new LoadBalancerStack(mainStack, 'LoadBalancerStack', {
    ...props,
    vpc: networkStack.vpc,
    publicLoadBalancerSecurityGroup: networkStack.publicLoadBalancerSecurityGroup,
    backendLoadBalancerSecurityGroup: networkStack.backendLoadBalancerSecurityGroup,
    certificateArn: 'arn:aws:acm:ap-southeast-3:968874455930:certificate/73c33d82-4a42-43fe-87fe-1b57b3a66c20',
});

// 5. Compute Layer
const computeStack = new ComputeStack(mainStack, 'ComputeStack', {
    ...props,
    vpc: networkStack.vpc,
});


// 6. Service Layer
const serviceStack = new ServiceStack(mainStack, 'ServiceStack', {
    ...props,
    vpc: networkStack.vpc,
    cluster: computeStack.cluster,
    database: databaseStack.database,
    redis: databaseStack.redis,
    sitesFs: storageStack.sitesFs,
    logsFs: storageStack.logsFs,
    publicAlbListener: loadBalancerStack.publicAlbListener,
    backendAlb: loadBalancerStack.backendAlb,
    backendAlbListener: loadBalancerStack.backendAlbListener,
    frontendTargetGroup: loadBalancerStack.frontendTargetGroup,
    socketIoTargetGroup: loadBalancerStack.socketIoTargetGroup,
    backendTargetGroup: loadBalancerStack.backendTargetGroup,
    frontendServiceSecurityGroup: networkStack.frontendServiceSecurityGroup,
    socketIoServiceSecurityGroup: networkStack.socketIoServiceSecurityGroup,
    backendServiceSecurityGroup: networkStack.backendServiceSecurityGroup,
    commonServiceSecurityGroup: networkStack.commonServiceSecurityGroup,
    ecrImage: '968874455930.dkr.ecr.ap-southeast-3.amazonaws.com/fayolex:latest',
});

databaseStack.addDependency(networkStack);
storageStack.addDependency(networkStack);
loadBalancerStack.addDependency(networkStack);
computeStack.addDependency(networkStack);

serviceStack.addDependency(networkStack);
serviceStack.addDependency(databaseStack);
serviceStack.addDependency(storageStack);


app.synth();