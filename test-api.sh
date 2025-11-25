#!/bin/bash

echo "🧪 Testing LLT Assistant Backend API"
echo "======================================"
echo

# Base URL
BASE_URL="http://localhost:8886"
echo "Backend: $BASE_URL"
echo

# Test 1: Health Check
echo "1️⃣  GET /health"
echo "-------------"
curl -s -X GET "$BASE_URL/health" | jq .
echo
echo

# Test 2: POST /context/projects/initialize (minimal payload)
echo "2️⃣  POST /context/projects/initialize"
echo "-----------------------------------"

# Generate a test project ID
PROJECT_ID="test-project-$$"
WORKSPACE_PATH="/tmp/test-workspace"

cat > /tmp/test-payload.json <<EOF
{
  "project_id": "$PROJECT_ID",
  "workspace_path": "$WORKSPACE_PATH",
  "language": "python",
  "files": [
    {
      "path": "test_file.py",
      "symbols": [
        {
          "name": "test_function",
          "kind": "function",
          "signature": "test_function(param: int) -> str",
          "line_start": 0,
          "line_end": 10,
          "calls": []
        }
      ]
    }
  ]
}
EOF

echo "Request payload:"
cat /tmp/test-payload.json | jq .
echo
echo "Response:"
curl -s -X POST "$BASE_URL/context/projects/initialize" \
  -H "Content-Type: application/json" \
  -d @/tmp/test-payload.json

echo
echo
echo "3️⃣  Check if server logs show any errors"
echo "---------------------------------------"
echo "💡 Run 'docker logs <container-id>' to see backend logs"