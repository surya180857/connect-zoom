# HTTP vhost (certbot will upgrade to HTTPS)
sudo tee /etc/nginx/sites-available/connectdev.conf >/dev/null <<'NGINX'
server {
  listen 80;
  server_name connectdev.airahr.ai;

  location / {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600;
    proxy_send_timeout 3600;
    client_max_body_size 200m;
  }
}
NGINX

sudo ln -s /etc/nginx/sites-available/connectdev.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# TLS (after DNS resolves)
sudo certbot --nginx -d connectdev.airahr.ai --redirect -n --agree-tos -m sridhar.kotha@airahr.ai


