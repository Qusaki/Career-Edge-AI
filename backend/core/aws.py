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

AWS_S3_ABSTRACTS_BUCKET_NAME = os.getenv("AWS_S3_ABSTRACTS_BUCKET_NAME")

def upload_abstract_to_s3(file: UploadFile, session_id: int) -> str:
    """
    Upload a thesis abstract to the abstracts S3 bucket.
    """
    if not all([AWS_REGION, AWS_S3_ABSTRACTS_BUCKET_NAME]):
        raise ValueError("AWS abstracts bucket configuration is missing in environment variables.")

    object_name = f"abstracts/session_{session_id}_{file.filename}"

    try:
        s3_client.upload_fileobj(
            file.file,
            AWS_S3_ABSTRACTS_BUCKET_NAME,
            object_name,
            ExtraArgs={"ContentType": file.content_type}
        )
        return object_name
    except Exception as e:
        raise ValueError(f"Failed to upload abstract: {e}")

import PyPDF2
import io

def get_abstract_text_from_s3(object_key: str) -> str:
    """
    Download abstract from S3 and extract its text (PDF supported).
    """
    try:
        response = s3_client.get_object(Bucket=AWS_S3_ABSTRACTS_BUCKET_NAME, Key=object_key)
        file_content = response['Body'].read()
        
        if object_key.lower().endswith('.pdf'):
            reader = PyPDF2.PdfReader(io.BytesIO(file_content))
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
            return text
        else:
            # Assume text based
            return file_content.decode('utf-8')
    except Exception as e:
        print(f"Error fetching/parsing abstract: {e}")
        return ""

def delete_abstract_from_s3(object_key: str):
    """
    Delete the abstract object securely after interview finishes.
    """
    if not object_key:
        return
    try:
        s3_client.delete_object(Bucket=AWS_S3_ABSTRACTS_BUCKET_NAME, Key=object_key)
        print(f"[DEBUG] Successfully deleted abstract logic: {object_key}")
    except Exception as e:
        print(f"Failed to delete abstract {object_key}: {e}")
