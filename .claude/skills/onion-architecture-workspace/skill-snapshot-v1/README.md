# Onion Architecture — джерела та обґрунтування

Дослідження, на основі якого побудовано [SKILL.md](SKILL.md): оригінальне визначення
Onion Architecture, її місце серед споріднених патернів (Hexagonal, Clean), практичне
застосування зі стеком Fastify + Drizzle + Zod, і застереження щодо надмірного
ускладнення — звідки й походить рішення про градуйоване (не тотальне) впровадження.

## Джерела

| Джерело | Що покриває | Ключовий висновок |
|---|---|---|
| [Jeffrey Palermo — The Onion Architecture, Part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) | Оригінальне визначення (2008), автор терміна | «All code can depend on layers more central, but code cannot depend on layers further out from the core» — правило напрямку залежностей, покладене в основу SKILL.md |
| [Jeffrey Palermo — Part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/), [Part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/), [Part 4 — After Four Years](http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/) | Розвиток ідеї та ретроспектива автора через 4 роки | Domain Model — центр без зовнішніх залежностей; UI, інфраструктура й тести — на зовнішніх кільцях, доступ лише через інтерфейси, визначені в ядрі |
| [Herberto Graça — Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/) | Зв'язок Onion із Hexagonal (Ports & Adapters) та DDD | Onion **розбудовує** Hexagonal, додаючи явне внутрішнє шарування бізнес-логіки (Domain Model → Domain Services → Application Services) — звідси таблиця "кілець" у SKILL.md |
| [Bitloops — Onion Architecture: Concentric Layers Without Compromise](https://bitloops.com/resources/software-architecture/onion-architecture) | Детальний розклад шарів + repository pattern | «Domain logic is sacred and isolated. Everything else — UI, persistence, external services — is infrastructure that adapts to the domain, not the reverse» — джерело правила "Domain Purity" |
| [Allegro Tech — Onion Architecture](https://blog.allegro.tech/2023/02/onion-architecture.html) | Практичне застосування в продакшн-бекенді, тестованість | «The domain should be free from technical and framework-related problems, allowing for easy testing and rapid development» — обґрунтування, чому `reviewer-core` без інфра-залежностей — це правильний приклад |
| [Eric Damtoft — Onion vs Clean vs Hexagonal Architecture](https://medium.com/@edamtoft/onion-vs-clean-vs-hexagonal-architecture-9ad94a27da91) | Спільне та відмінне між трьома спорідненими патернами | Всі три виносять інфраструктуру, сховище даних та UI на периферію — це той самий концепт під різними назвами, тому SKILL.md не протиставляє їх, а бере Onion як робочу термінологію для цього репо |
| [NDepend — Onion Architecture: Going Beyond Layers](https://blog.ndepend.com/onion-architecture-layers/) | Класичне пояснення напрямку зв'язності (coupling) | «Direction of coupling is toward the center» — те саме правило, іншими словами; підтверджує консенсус джерел |
| [marcoturi/fastify-boilerplate](https://github.com/marcoturi/fastify-boilerplate) | Готовий приклад Fastify 5 + Clean/Onion Architecture + DDD | Явний потік `Route → Handler → Domain → Repository`, «inward dependency flow — outer layers depend on inner layers, never the reverse» — найближчий до нашого стеку приклад (Fastify), звідки взято мапінг routes→service→repository→domain |
| [André Bazaglia — Clean architecture with TypeScript: DDD, Onion](https://bazaglia.com/clean-architecture-with-typescript-ddd-onion/) | Мапінг Onion/Clean на конкретний TypeScript-проєкт | Репозиторії як інтерфейси в domain-шарі, реалізація — в infra; шари `domain / app / infra / api` без низхідних залежностей — узгоджується з правилом "Repository Pattern & Dependency Inversion" |
| [sebi75/drizzle-inversify-social-media](https://github.com/sebi75/drizzle-inversify-social-media) | Приклад Drizzle ORM + dependency injection (Inversify) | Показує, що інверсія залежностей природно лягає на Drizzle-репозиторії — підтверджує, що наш існуючий `repository.ts` (типізовані `Insert*`) уже і є цим механізмом |
| [cosmicpython.com — The Repository Pattern](https://www.cosmicpython.com/book/chapter_02_repository) | Класичне обґрунтування repository pattern як абстракції над сховищем | Repository ізолює доменну/прикладну логіку від деталей ORM, дозволяючи тестувати сервіси без реальної БД |
| [Victor Rentea — Overengineering in Onion/Hexagonal Architectures](https://victorrentea.ro/blog/overengineering-in-onion-hexagonal-architectures/) | Застереження щодо надмірного застосування патерну | «When testing is hard, the production design can be improved, or you're testing too fine-grained» — для CRUD-модулів "за підручником" шарування створює зайвий boilerplate й ускладнює тести — основа рішення про градуйоване впровадження |
| [Three Dots Labs — Is Clean Architecture Overengineering?](https://threedots.tech/episode/is-clean-architecture-overengineering/) | Коли шарована архітектура виправдана, а коли — ні | «If you are using some architecture and it's slowing you down, you cannot iterate faster, it's probably the bad one» — для малих команд/тривіальних CRUD-модулів повне шарування — овercomplication; підтверджує рішення "новий код only" |
| [oneuptime.com — How to Validate Data with Zod in TypeScript](https://oneuptime.com/blog/post/2026-01-25-zod-validation-typescript/view) | Де саме валідувати вхідні дані у шарованому застосунку | Валідація Zod належить межі API/мережі (там, де дані перетинають межу довіри); доменні інваріанти — окрема відповідальність сервісного шару |

## Консенсус

Усі архітектурні джерела (Palermo, Graça, Bitloops, NDepend, Allegro, Damtoft)
сходяться в одному: **залежності мають вказувати всередину, до домену, який не
знає нічого про фреймворк, БД чи HTTP.** Onion, Hexagonal і Clean — це той самий
принцип під різними іменами; для DevDigest обрано термінологію Onion, бо вона
найточніше описує вже наявну в репозиторії структуру (`reviewer-core` як чисте
ядро, `service.ts`/`repository.ts` як прикладний і інфраструктурний шари,
`routes.ts` як зовнішній). Практичні джерела зі стеком, близьким до нашого
(`marcoturi/fastify-boilerplate` — Fastify; `sebi75/drizzle-inversify-social-media`,
Bazaglia — TypeScript + Drizzle-подібний ORM; oneuptime — Zod) підтверджують, що
цей мапінг напряму переноситься на Fastify + Drizzle + Zod без додаткових
абстракцій. Джерела про надмірне ускладнення (Rentea, Three Dots Labs) — причина,
чому SKILL.md вимагає повне 4-шарове розділення **не для всіх модулів**, а лише
для тих, де справді є бізнес-логіка (рішення, обчислення, координація кількох
джерел даних); чисті CRUD-модулі (`pulls`, `polling`, `workspace`) залишаються
пласкими навмисно, а не через недбалість.

## Статус

Підготовлено як джерела для нового скіла `onion-architecture`
(`.claude/skills/onion-architecture/`). Цитати з `jeffreypalermo.com`, `herbertograca.com`,
`bitloops.com`, `blog.allegro.tech`, `github.com/marcoturi/fastify-boilerplate`,
`bazaglia.com`, `victorrentea.ro`, `threedots.tech` та `oneuptime.com` отримано напряму
зі сторінок. Джерела `blog.ndepend.com` та `cosmicpython.com` блокують автоматичний
фетч (HTTP 403) — їхні тези наведено за результатами пошуку, без прямого цитування.
