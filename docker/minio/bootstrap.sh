#!/bin/sh
# Prepares the development object store for direct-to-S3 uploads.
#
# Runs once per `docker compose up` as the `minio-init` service, then exits. The
# API is a *client* of this bucket and cannot create it: in a deployment it holds
# credentials scoped to objects, not to bucket administration. Provisioning lives
# here so that `down -v` followed by `up` rebuilds a working store with no manual
# step.
set -eu

ALIAS=local
BUCKET="${S3_BUCKET:-immich-clone}"
ORIGIN="${CORS_ORIGIN:-http://localhost:3000}"

# MinIO answers its health endpoint well before the S3 API accepts signed
# requests, so we retry the alias itself rather than trusting a container
# healthcheck. `mc alias set` performs a real `ListBuckets` under the hood.
until mc alias set "$ALIAS" "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null 2>&1; do
  echo "minio-init: waiting for ${S3_ENDPOINT}"
  sleep 1
done

# Private bucket. Every read goes through the API or a short-lived presigned URL;
# nothing is ever publicly readable.
mc mb --ignore-existing "$ALIAS/$BUCKET" >/dev/null
mc anonymous set private "$ALIAS/$BUCKET" >/dev/null 2>&1 || true

# The browser has to read `ETag` off the PUT response: it is the part handle that
# `CompleteMultipartUpload` requires. CORS hides response headers from JavaScript
# unless they are named in `ExposeHeaders`, and without it multipart uploads
# cannot be finished from the web client.
cat >/tmp/cors.json <<JSON
{
  "CORSRules": [
    {
      "AllowedOrigins": ["${ORIGIN}"],
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "x-amz-version-id"],
      "MaxAgeSeconds": 3000
    }
  ]
}
JSON

mc cors set "$ALIAS/$BUCKET" /tmp/cors.json >/dev/null 2>&1 ||
  echo "minio-init: could not set CORS on ${BUCKET}; multipart uploads from the browser will fail"

# An abandoned multipart upload keeps its parts on disk and on the bill forever.
# The API's sweeper reclaims sessions it knows about, but a tab killed mid-PUT
# leaves parts MinIO knows about and the API does not, so expire those here too.
mc ilm rule add --abort-incomplete-multipart-upload-days 1 "$ALIAS/$BUCKET" >/dev/null 2>&1 ||
  mc ilm add --abort-incomplete-multipart-upload-days 1 "$ALIAS/$BUCKET" >/dev/null 2>&1 ||
  echo "minio-init: could not add the abort-incomplete-multipart rule on ${BUCKET}"

echo "minio-init: bucket ${BUCKET} is ready"
