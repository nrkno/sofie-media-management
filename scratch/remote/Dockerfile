# syntax=docker/dockerfile:experimental
# BUILD IMAGE
FROM node:12-buster

RUN apt-get update && apt-get install -y \
    build-essential \
    g++ \
    libavcodec-dev libavformat-dev libavdevice-dev libavfilter-dev libavutil-dev libpostproc-dev libswresample-dev libswscale-dev

WORKDIR /opt/remote-worker
COPY . .
RUN yarn install --check-files --frozen-lockfile
RUN yarn build:main
CMD ["yarn", "start"]
# RUN yarn build
# RUN yarn install --check-files --frozen-lockfile --production --force # purge dev-dependencies

# DEPLOY IMAGE
# FROM node:12-slim

# RUN apt-get update && apt-get install -y \
#    libomniorb4-1 \
#    && rm -rf /var/lib/apt/lists/*

# COPY --from=0 /opt/quantel-gateway /opt/quantel-gateway
# WORKDIR /opt/quantel-gateway

# EXPOSE 3000
# CMD ["yarn", "start"]
