FROM node:22-alpine3.19

ARG PORT

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE $PORT