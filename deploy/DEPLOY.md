# Деплой на сервер (Ubuntu + Nginx + HTTPS)

## 1) Подготовка сервера

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

Установите Node.js (рекомендуется LTS 22+) и скопируйте проект на сервер.

## 2) Запуск приложения

```bash
npm install
ADD_PLACE_PASSWORD="ваш_сложный_пароль" PORT=3000 npm start
```

Для постоянной работы используйте `pm2` или `systemd`.

## 3) Где указывать домен

Откройте файл `deploy/nginx-example.conf` и замените:

- `map.example.ru`
- `www.map.example.ru`

на ваш реальный домен.

Именно в строке `server_name` указывается домен.

## 4) Подключение конфига Nginx

```bash
sudo cp deploy/nginx-example.conf /etc/nginx/sites-available/nizhneudinsk-map
sudo ln -s /etc/nginx/sites-available/nizhneudinsk-map /etc/nginx/sites-enabled/nizhneudinsk-map
sudo nginx -t
sudo systemctl reload nginx
```

## 5) DNS

У регистратора домена создайте A-запись:

- `@` -> IP вашего сервера
- `www` -> IP вашего сервера (если нужен поддомен)

## 6) Как получить сертификат HTTPS

После того как DNS начал указывать на сервер:

```bash
sudo certbot --nginx -d map.example.ru -d www.map.example.ru
```

Certbot автоматически добавит SSL-секцию в Nginx и настроит редирект на HTTPS.

Проверка автообновления:

```bash
sudo certbot renew --dry-run
```

## 7) Проверка

- `https://ваш-домен` открывается без предупреждений.
- На сайте работает карта и список мест.
- Вход в режим редактирования требует пароль.
