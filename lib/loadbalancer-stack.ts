import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export interface LoadBalancerStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  publicLoadBalancerSecurityGroup: ec2.SecurityGroup;
  backendLoadBalancerSecurityGroup: ec2.SecurityGroup;
  certificateArn?: string;
}

export class LoadBalancerStack extends cdk.NestedStack {
  public readonly publicAlb: elbv2.ApplicationLoadBalancer;
  public readonly publicAlbListener: elbv2.ApplicationListener;
  public readonly backendAlb: elbv2.ApplicationLoadBalancer;
  public readonly backendAlbListener: elbv2.ApplicationListener;
  public readonly frontendTargetGroup: elbv2.ApplicationTargetGroup;
  public readonly socketIoTargetGroup: elbv2.ApplicationTargetGroup;
  public readonly backendTargetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: LoadBalancerStackProps) {
    super(scope, id, props);

    // Create Public ALB
    this.publicAlb = new elbv2.ApplicationLoadBalancer(this, 'PublicALB', {
      vpc: props.vpc,
      internetFacing: true,
      http2Enabled: true,
      securityGroup: props.publicLoadBalancerSecurityGroup,
    });

    // Add HTTP to HTTPS redirect
    this.publicAlb.addRedirect({
      sourcePort: 80,
      targetPort: 443,
      open: true
    });

    // Create HTTPS listener
    this.publicAlbListener = this.publicAlb.addListener('HttpsListener', {
      port: 443,
      certificates: props.certificateArn 
        ? [elbv2.ListenerCertificate.fromArn(props.certificateArn)]
        : undefined,
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
    });

    // Add default action for the public listener
    this.publicAlbListener.addAction('DefaultAction', {
      action: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'ALB is ready',
      }),
    });

    // Create Backend ALB
    this.backendAlb = new elbv2.ApplicationLoadBalancer(this, 'BackendALB', {
      vpc: props.vpc,
      internetFacing: false,
      securityGroup: props.backendLoadBalancerSecurityGroup,
    });

    // Create Target Groups
    this.frontendTargetGroup = new elbv2.ApplicationTargetGroup(this, 'FrontendTG', {
      vpc: props.vpc,
      port: 8080,
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
      },
    });

    this.socketIoTargetGroup = new elbv2.ApplicationTargetGroup(this, 'SocketIoTG', {
      vpc: props.vpc,
      port: 9000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      healthCheck: {
        path: '/socket.io/health',
        interval: cdk.Duration.seconds(30),
      },
    });

    this.backendTargetGroup = new elbv2.ApplicationTargetGroup(this, 'BackendTG', {
      vpc: props.vpc,
      port: 8000,
      healthCheck: {
        path: '/api/method/ping',
      },
    });

    // Create Backend Listener
    this.backendAlbListener = this.backendAlb.addListener('BackendListener', {
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.forward([this.backendTargetGroup]),
    });

    // Configure frontend and socket.io routing rules
    this.publicAlbListener.addAction('SocketIoAction', {
      priority: 10,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/socket.io/*'])
      ],
      action: elbv2.ListenerAction.forward([this.socketIoTargetGroup])
    });

    this.publicAlbListener.addAction('FrontendAction', {
      priority: 20,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/'])
      ],
      action: elbv2.ListenerAction.forward([this.frontendTargetGroup])
    });
  }
}