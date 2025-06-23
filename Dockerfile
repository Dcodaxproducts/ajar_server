# Base stage
FROM node:latest AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

# Development Stage
FROM base AS development
WORKDIR /app
COPY . .
RUN npm install -g nodemon  
EXPOSE 9000
CMD ["nodemon", "--inspect=0.0.0.0", "src/server.ts"]  

# Production Stage
FROM base AS production
WORKDIR /app
COPY . .
RUN npm run build
RUN npm install -g pm2
EXPOSE 9000
CMD ["pm2-runtime", "dist/server.js"]
