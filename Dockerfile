FROM node:20-slim

# Install Tesseract OCR (required by node-tesseract-ocr)
RUN apt-get update && \
    apt-get install -y tesseract-ocr && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Fail the BUILD (not silently at runtime) if index.html didn't make it into
# the image — this is exactly what was causing "ENOENT ... /app/index.html"
# at container startup with no clue why.
RUN test -f index.html || (echo "BUILD FAILED: index.html missing from build context — check .dockerignore and that you're building from the repo root" && exit 1)

EXPOSE 5000

CMD ["node", "server.js"]
