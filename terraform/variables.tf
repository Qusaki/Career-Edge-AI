variable "aws_region" {
  description = "AWS region"
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name for the project"
  default     = "career-edge-ai"
}

variable "db_password" {
  description = "PostgreSQL DB password"
  type        = string
  sensitive   = true
  default     = "***REMOVED***"
}

variable "db_username" {
  description = "PostgreSQL DB username"
  type        = string
  default     = "postgres"
}
