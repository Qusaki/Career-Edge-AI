import boto3
import os
from fastapi import UploadFile
from botocore.exceptions import NoCredentialsError, ClientError

# Read AWS config from environment
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION")
AWS_S3_BUCKET_NAME = os.getenv("AWS_S3_BUCKET_NAME")

# Validate required variables
if not all([AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET_NAME]):
    # We will raise the error later during upload to avoid crashing the whole app on import
    # but let's at least initialize the client safely if possible
    pass

# Initialize s3_client conditionally
if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
    s3_client = boto3.client(
        "s3",
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        region_name=AWS_REGION,
    )
else:
    # Fallback to IAM Role (e.g. on EC2)
    s3_client = boto3.client("s3", region_name=AWS_REGION)

def upload_file_to_s3(file: UploadFile, object_name: str = None) -> str:
    """
    Upload a file to an S3 bucket and return its public URL.
    """
    if not all([AWS_REGION, AWS_S3_BUCKET_NAME]):
        raise ValueError("AWS configuration (Bucket/Region) is missing in environment variables.")

    if object_name is None:
        object_name = file.filename

    try:
        s3_client.upload_fileobj(
            file.file,
            AWS_S3_BUCKET_NAME,
            object_name,
            ExtraArgs={"ContentType": file.content_type}
        )
        
        # Construct the URL of the uploaded file
        url = f"https://{AWS_S3_BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com/{object_name}"
        return url
        
    except FileNotFoundError:
        raise ValueError("The file was not found")
    except NoCredentialsError:
        raise ValueError("Credentials not available")
    except ClientError as e:
        raise ValueError(f"AWS Client error: {e}")
