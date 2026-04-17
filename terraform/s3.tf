data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "profile_pictures" {
  bucket = "${var.project_name}-profile-pictures-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${var.project_name}-profile-pictures"
  }
}

resource "aws_s3_bucket_ownership_controls" "profile_pictures" {
  bucket = aws_s3_bucket.profile_pictures.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_public_access_block" "profile_pictures" {
  bucket = aws_s3_bucket.profile_pictures.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "public_read" {
  bucket = aws_s3_bucket.profile_pictures.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.profile_pictures.arn}/*"
      }
    ]
  })

  depends_on = [
    aws_s3_bucket_public_access_block.profile_pictures,
    aws_s3_bucket_ownership_controls.profile_pictures
  ]
}

resource "aws_s3_bucket" "abstracts" {
  bucket = "${var.project_name}-abstracts-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${var.project_name}-abstracts"
  }
}

resource "aws_s3_bucket_ownership_controls" "abstracts" {
  bucket = aws_s3_bucket.abstracts.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "abstracts" {
  bucket = aws_s3_bucket.abstracts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
