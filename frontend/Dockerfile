FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
# This is a browser URL, resolved through the frontend's Nginx proxy.
# Set it for the build so a local development API URL is never baked in.
RUN VITE_API_URL=/api npm run build

FROM nginx:stable-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

# The custom configuration supports a read-only root filesystem. Bypass the
# image's default startup scripts, which try to modify /etc/nginx.
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
