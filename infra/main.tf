terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "ai-job-copilot"
}

# Example placeholders for a production layout:
# - S3 + CloudFront for the Vite build
# - ECS Fargate service for the Express API
# - RDS PostgreSQL (with pgvector) + ElastiCache Redis
# - ALB in front of ECS, WAF optional
#
# Wire these resources with remote state + modules when you are ready to deploy.

output "next_steps" {
  value = "Fill in VPC, subnets, security groups, RDS, ElastiCache, ECS task definitions, and CloudFront origins."
}
