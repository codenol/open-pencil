# Сервис хранилища документов

Простой HTTP-сервис без зависимостей: хранит файлы документов OpenPencil,
их метаданные и превью. Работает рядом с редактором на том же сервере.

## Запуск

```
node tools/storage/server.mjs
```

Переменные окружения:

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `7802` | порт (слушает только 127.0.0.1) |
| `ROOT` | `/var/lib/openpencil-norka` | каталог данных |

## Установка как сервис

```
cp tools/storage/openpencil-norka.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now openpencil-norka
```

## API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | состояние сервиса |
| GET | `/api/documents` | список документов |
| GET | `/api/documents/<id>` | содержимое `.fig` |
| PUT | `/api/documents/<id>` | сохранить (тело — `.fig`) |
| DELETE | `/api/documents/<id>` | удалить |
| GET | `/api/documents/<id>/metadata` | имя и время изменения |
| GET/PUT | `/api/documents/<id>/thumbnail` | превью |

## Структура данных

```
files/<id>.fig      содержимое документа
meta/<id>.json      имя, время изменения
thumbs/<id>.png     превью для списка
```

## Как связано с редактором

В OpenPencil есть провайдер хранилища `norka-server`
(`src/app/integrations/storage/norka/adapter.ts`), он ходит в этот сервис.
По умолчанию адрес — `/store` на том же домене, поэтому нужен проксирующий
`location /store/` в nginx.
