output "ec2_public_ip" {
  value       = aws_instance.web.public_ip
  description = "The public IP address of the EC2 instance"
}

output "rds_endpoint" {
  value       = aws_db_instance.postgres.endpoint
  description = "The endpoint of the RDS instance"
}

output "s3_bucket_name" {
  value       = aws_s3_bucket.profile_pictures.bucket
  description = "The name of the S3 bucket for profile pictures"
}

output "abstracts_bucket_name" {
  value       = aws_s3_bucket.abstracts.bucket
  description = "The name of the S3 bucket for thesis abstracts"
}
