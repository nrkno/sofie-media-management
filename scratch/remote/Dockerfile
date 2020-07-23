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
RUN yarn install --check-files --frozen-lockfile --production --force # purge dev-dependencies

# DEPLOY IMAGE
FROM node:12-buster-slim

RUN apt-get update && apt-get install -y \
    libavcodec58 libavformat58 libavdevice58 libavfilter7 libavutil56 libpostproc55 libswresample3 libswscale5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=0 /opt/remote-worker /opt/remote-worker
WORKDIR /opt/quantel-gateway
EXPOSE 4200 4201 4202 4203 4204 4205
CMD ["yarn", "start"]
