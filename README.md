# AWS CDK Infrastructure for Frappe ERPNext

This project provides infrastructure as code using AWS CDK to deploy Frappe ERPNext in a production-ready environment on AWS. It leverages managed services for reliability, scalability, and reduced maintenance overhead.

## Architecture Overview

The infrastructure consists of the following key components:

- **Compute (ECS)**: Containerized deployment using Amazon ECS for running Frappe/ERPNext services
- **Database (RDS)**: Managed MariaDB database for reliable data storage
- **Storage (EFS)**: Elastic File System for persistent storage of sites and assets
- **Networking**: VPC with public and private subnets across multiple availability zones

![Architecture Diagram] (Coming soon)

## Stack Components

- `NetworkStack`: VPC, subnets, and networking components
- `LoadBalancerStack`: Application Load Balancer for traffic distribution
- `DatabaseStack`: Amazon RDS MariaDB instance
- `StorageStack`: EFS file system and mount targets
- `ComputeStack`: ECS cluster configuration
- `ServiceStack`: ECS services and task definitions for Frappe/ERPNext

## Prerequisites

- AWS Account and configured credentials
- Node.js 14.x or later
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- Docker installed locally

## Deployment Instructions

1. Clone the repository:
```bash
git clone [repository-url]
cd cdk-aws
```

2. Install dependencies:
```bash
npm install
```

3. Update configurations:
   - Review and modify `pwd.yml` for database credentials
   - Adjust environment variables in service definitions if needed

4. Deploy the infrastructure:
```bash
cdk deploy --all
```

## Features

- **High Availability**: Multi-AZ deployment for critical components
- **Scalability**: ECS services can be scaled based on demand
- **Security**:
  - Private subnets for application and database
  - Security groups for network isolation
  - SSL/TLS encryption for data in transit
- **Backup & Recovery**: Automated RDS backups
- **Monitoring**: CloudWatch integration for logs and metrics

## Useful Commands

- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and compile
- `npm run test` - Run the test suite
- `cdk diff` - Compare deployed stack with current state
- `cdk synth` - Emit synthesized CloudFormation template
- `cdk deploy` - Deploy this stack to your default AWS account/region

## Cost Considerations

This infrastructure uses the following billable AWS services:
- Amazon ECS (Fargate)
- Amazon RDS
- Amazon EFS
- Application Load Balancer
- VPC components (NAT Gateway, etc.)

Monitor your AWS cost explorer to understand the running costs.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE)
