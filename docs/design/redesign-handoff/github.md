repo: valroi/iva_tdo
branch: main

## Last sync

date: 2026-08-11T08:40:05Z
note: коммит не зафиксирован (доступен только tree-hash a22b865fdc1b). Прочитаны README, docs/SYSTEM_ANALYSIS_RU.md, docs/PROCESS_MATRIX_RU.md, база знаний docs/kb (Карта проекта, Жизненный цикл ревизии, CRS, Роли и права, ТРМ, Замечания и PDF, Фронтенд), frontend/src/App.tsx, DashboardPage.tsx, DocumentsRegistryPage.tsx.

### Updated in this project
- Экраны редизайна пересобраны по реальной доменной модели (DCC: MDR → ревизии → замечания → CRS → ТРМ)
- Навигация повторяет App.tsx: модули DCC / Закупки / FEED + разделы Обзор, Проекты, Документы, ТРМ, Очередь ТРМ, CRS, Уведомления, Отчётность, Администрирование
- Реестр документов: фильтры и колонки из DocumentsRegistryPage, раскрытие ревизий, секции по категориям PD/SE
- Удалены ранние концепты, построенные без доступа к коду

## Screen map

| Экран проекта | Файлы репозитория |
| --- | --- |
| Вход | frontend/src/components/LoginForm.tsx, docs/LOGIN_CREDENTIALS_RU.md |
| Обзор | frontend/src/pages/DashboardPage.tsx |
| Документы и ревизии | frontend/src/pages/DocumentsRegistryPage.tsx |
| Карточка документа | frontend/src/pages/RevisionCardPage.tsx, docs/kb/10-домен/Жизненный цикл ревизии.md, Замечания и PDF.md |
| Очередь ТРМ | frontend/src/pages/TdoQueuePage.tsx, docs/kb/10-домен/ТРМ.md |
| Формирование CRS | frontend/src/pages/CrsPage.tsx, docs/kb/10-домен/CRS и передача замечаний.md |
| Реестр ТРМ | frontend/src/pages/TrmRegistryPage.tsx |
| Оболочка (сайдбар, модули, шапка) | frontend/src/App.tsx, frontend/src/styles.css |
