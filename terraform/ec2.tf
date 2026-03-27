data "aws_ami" "ubuntu" {
  most_recent = true

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  owners = ["099720109477"] # Canonical
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.public.id

  vpc_security_group_ids = [aws_security_group.web_sg.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name
  
  # For SSH access, you usually provide a key name.
  # key_name = "your-key-pair-name"
  
  associate_public_ip_address = true

  user_data = <<-EOF
              #!/bin/bash
              apt-get update
              apt-get install -y ca-certificates curl gnupg unzip awscli
              install -m 0755 -d /etc/apt/keyrings
              curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
              chmod a+r /etc/apt/keyrings/docker.gpg
              
              echo \
                "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
                "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
                tee /etc/apt/sources.list.d/docker.list > /dev/null
              
              apt-get update
              apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
              
              systemctl enable docker
              systemctl start docker
              usermod -aG docker ubuntu

              # Get Region and Account ID dynamically
              TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
              REGION=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -s http://169.254.169.254/latest/meta-data/placement/region)
              ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region $REGION)

              # Login to ECR
              aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com
              
              # Run the Docker container exposing Port 80
              docker run -d --restart always -p 80:8000 \
                -e DATABASE_URL="postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.endpoint}/${aws_db_instance.postgres.db_name}" \
                -e AWS_REGION=$REGION \
                -e AWS_S3_BUCKET_NAME="${aws_s3_bucket.profile_pictures.bucket}" \
                -e GEMINI_API_KEY="${var.gemini_api_key}" \
                $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/fastapi-backend:latest
              EOF

  tags = {
    Name = "$${var.project_name}-web"
  }
}
