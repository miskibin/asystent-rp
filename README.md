# Asystent RP

[Asystent RP](https://chat.sejm-stats.pl/) pomaga analizować dane Sejmu, ustawy, głosowania i wypowiedzi oraz przygotowywać robocze pisma. Odpowiedzi powstają z użyciem DeepSeek i narzędzi odczytujących dane Tygodnika Sejmowego. Logowanie, rozmowy i uprawnienia użytkowników obsługuje Supabase.

## Interfejs chat-components

Interfejs korzysta z komponentów źródłowych [miskibin/chat-components](https://github.com/miskibin/chat-components), zgodnie z modelem dystrybucji registry tej biblioteki. Pochodzenie oraz SHA-256 plików zapisuje `chat-components.lock.json`; pliki biblioteki pozostają identyczne z upstreamem, a integracja aplikacji znajduje się w `components/chat-workspace.tsx`.

- Nawigacja rozmów: wyszukiwanie, zmiana nazwy, przypinanie, sortowanie przez przeciąganie, operacje zbiorcze, zwijanie i zmiana szerokości panelu.
- Edytor wiadomości: wiele wierszy, załączniki, komendy `/`, skróty `$`, wzmianki `@` o dokumentach, historia promptów, kolejka podczas generowania i szkice zapisywane przez Ctrl/Cmd+S. Szkice wymagają wybrania edycji przed wysłaniem.
- Tryby Asystent, Pytanie i Plan przekazywane do backendu; selektor pokazuje jedyny model skonfigurowany na serwerze. Wskaźnik kontekstu szacuje rozmiar przyciętej historii w znakach, wraz z treścią załączników.
- Wiadomości: Markdown, tabele, kod, matematyka, Mermaid, oś pracy narzędzi, cytowanie zaznaczenia, kopiowanie, pobieranie, edycja, ponowne generowanie oraz źródła zwrócone przez narzędzia danych.
- Narzędzia prezentacji: pytania z wyborem odpowiedzi, plany i listy zadań, robocze dokumenty. Odpowiedź na pytanie jest zapisywana i przekazywana w następnym wywołaniu modelu.
- Dokumenty: drzewo plików, podgląd, porównanie dwóch tekstów, komentarz do zakresu wierszy i pobieranie; panel dzielony na desktopie i dostępny z klawiatury podgląd na telefonie.
- Eksport rozmowy do Markdown, motyw jasny/ciemny, propozycje pytań i mobilny panel rozmów.

Backend obsługuje dokumenty tekstowe TXT, MD, CSV, JSON, XML, YAML i LOG: maksymalnie 3 pliki, łącznie 12 000 znaków. PDF, obrazy i pliki binarne wymagają osobnego mechanizmu ekstrakcji. Terminal, wybór katalogów systemowych i wykonywanie zmian w kodzie nie mają odpowiedników w backendzie asystenta obywatelskiego. Narzędzia planów i dokumentów przygotowują treść; nie wysyłają pism i nie wykonują działań za użytkownika.

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

Stos: Next.js 16, React 19, Tailwind CSS 4, chat-components, LangChain/deepagents, DeepSeek i Supabase.
