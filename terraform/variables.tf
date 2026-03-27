variable "aws_region" {
  description = "AWS region"
  default     = "ap-southeast-1"
}

variable "project_name" {
  description = "Name for the project"
  default     = "career-edge-ai"
}

variable "db_password" {
  description = "PostgreSQL DB password"
  type        = string
  sensitive   = true
}

variable "db_username" {
  description = "PostgreSQL DB username"
  type        = string
  default     = "postgres"
}

variable "gemini_api_key" {
  description = "API Key for Gemini"
  type        = string
  sensitive   = true
}
