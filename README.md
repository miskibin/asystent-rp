# Asystent RP

## Wspólne przepisy prawa

Narzędzia `search_legal_provisions`, `get_legal_provision` i `get_legal_changes` korzystają z `/api/prawo/*` Tygodnika, zachowując pełne jednostki, identyfikatory wersji, datę i źródła. `TYGODNIK_LAW_URL` może wskazać podgląd tego samego kontraktu. Przepisy omijają ogólny limit 700 znaków; przekroczenie budżetu odrzuca całe jednostki i blokuje odpowiedź.

Niepotwierdzona aktualność lub niekompletny kontekst zatrzymują generowanie porady po odczycie i zwracają sprawdzalne ograniczenie z odnośnikami. Model nie może zastąpić odmowy kolejną odpowiedzią z pamięci. Identyfikator wersji jest obowiązkowy przy pobieraniu wskazanej jednostki; API odrzuca rozbieżność. Cytowania zachowują dokładne kotwice artykułów. Przekazanie z widoku „Prawo” przygotowuje niewysłany szkic i przenosi go przez powrót z logowania.

Integracja wymaga wdrożonego kontraktu Tygodnika. Pierwszy import ma niepotwierdzoną aktualność, więc nie jest jeszcze podstawą odpowiedzi o obowiązującym prawie. Odbiór wymaga sprawdzenia tekstów, zależności i kontekstu oraz zaakceptowanego przez człowieka zbioru pytań. Testy jednostkowe i przeglądarkowe sprawdzają działanie kontraktu; nie zastępują odbioru jakości prawnej.

[Asystent RP](https://chat.tygodniksejmowy.pl/) pomaga analizować dane Sejmu, ustawy, głosowania i wypowiedzi oraz przygotowywać robocze pisma. Odpowiedzi powstają z użyciem DeepSeek i narzędzi odczytujących dane Tygodnika Sejmowego. Logowanie, rozmowy i uprawnienia użytkowników obsługuje Supabase.

## Interfejs chat-components

Interfejs korzysta z komponentów źródłowych [miskibin/chat-components](https://github.com/miskibin/chat-components), zgodnie z modelem dystrybucji registry tej biblioteki. Pochodzenie oraz SHA-256 plików zapisuje `chat-components.lock.json`; pliki biblioteki pozostają identyczne z upstreamem, a integracja aplikacji znajduje się w `components/chat-workspace.tsx`.

- Rozmowy: tytuł i data w dwóch wierszach, wyszukiwanie, zmiana nazwy, usuwanie oraz zwijany panel ze zmianą szerokości. Odwiedzone rozmowy są przechowywane w pamięci sesji; pierwsze otwarcie pokazuje stan ładowania.
- Edytor wiadomości: wiele wierszy, niewielkie załączniki tekstowe i zatrzymywanie odpowiedzi.
- Wiadomości: Markdown, tabele, kod, matematyka, Mermaid, kopiowanie, edycja, ponowne generowanie i źródła.
- Pływający przycisk motywu, propozycje pytań w nowej rozmowie oraz mobilny panel rozmów i przycisk nowego czatu.

To zwykły chatbot: interfejs nie udostępnia trybów agenta, planów, komend ani paneli pracy na dokumentach. Backend wywołuje model oraz trzy narzędzia odczytujące dane Sejmu, z limitem czterech wyszukiwań i pięciu wywołań modelu na odpowiedź. Doprecyzowanie i przygotowywane treści są częścią zwykłej rozmowy.

Backend obsługuje dokumenty tekstowe TXT, MD, CSV, JSON, XML, YAML i LOG: maksymalnie 3 pliki, łącznie 12 000 znaków. PDF, obrazy i pliki binarne wymagają osobnego mechanizmu ekstrakcji.

## Uruchomienie

Wymagane: Node.js 24, npm, projekt Supabase z konfiguracją OAuth oraz klucz DeepSeek. Skopiuj `.env.example` do `.env.local` i uzupełnij:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-auth-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-auth-project-anon-key
DEEPSEEK_API_KEY=your-deepseek-api-key
TYGODNIK_SUPABASE_URL=https://db.msulawiak.pl
TYGODNIK_SUPABASE_ANON_KEY=your-tygodnik-anon-key
```

Przed uruchomieniem nowego interfejsu zastosuj migracje z `supabase/migrations` w kolejności nazw. Migracja `20261006010000_chat_navigation.sql` dodaje `pinned`, `sort_order` i funkcję `reorder_chat_threads(uuid[])`. Bez niej zapytania listy rozmów nie zadziałają. Funkcja działa z uprawnieniami wywołującego i istniejącymi regułami RLS. W projekcie połączonym z Supabase CLI można użyć `supabase db push`.

```bash
npm ci
npm run dev
```

Wersja produkcyjna: `npm run build`, następnie `npm start`. To aplikacja z API i uwierzytelnianiem wymagająca środowiska Node.js, a nie eksport statyczny.

## Aktualizacja biblioteki

```bash
CHAT_COMPONENTS_SOURCE=../chat-components npm run vendor:sync
CHAT_COMPONENTS_SOURCE=../chat-components npm run vendor:check
```

`vendor:sync` kopiuje registry oraz wspólne prymitywy UI i zapisuje commit oraz hashe. `vendor:check` bez zmiennej sprawdza lokalne hashe; ze zmienną porównuje również bajty z checkoutem upstreamu. Aktualizując upstream, zachowaj poprawkę `patches/@pierre+diffs+1.4.1.patch` i przypiętą wersję `@pierre/diffs`; `npm ci` stosuje ją przez `patch-package`.

## Weryfikacja

```bash
npm run vendor:check
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Testy jednostkowe obejmują granice API, narzędzia, dokumenty, ograniczenia modelu, źródła i strumień SSE. Testy Playwright uruchamiają build produkcyjny i podstawiają odpowiedzi Supabase oraz API czatu; weryfikują przepływy UI bez kluczy do usług. Nie zastępują testu połączenia z rzeczywistym Supabase i DeepSeek. Opcjonalna zmienna `CHAT_TEST_CHROMIUM` wskazuje lokalny plik wykonywalny przeglądarki.

Stos: Next.js 16, React 19, Tailwind CSS 4, chat-components, LangChain Core/OpenAI, DeepSeek i Supabase.

