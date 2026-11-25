# ---------- 第一阶段：构建 ----------
# 只用来装依赖、跑 vite build，产物是 /app/dist
FROM node:20-alpine AS build

WORKDIR /app

# 国内构建换镜像源（换到境外机器可以删掉这行）
RUN npm config set registry https://registry.npmmirror.com

# 先拷清单，利用缓存：改代码不会重新装依赖
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- 第二阶段：运行 ----------
# 只保留 nginx 和静态文件，Node 和源码都不会进入最终镜像
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html

# 站点配置由 docker-compose 挂载进来（方便改，改完 nginx -s reload）
EXPOSE 80
