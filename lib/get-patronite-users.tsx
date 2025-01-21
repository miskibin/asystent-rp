"use server";

const PATRONITE_API_URL = process.env.PATRONITE_API_URL;
const PATRONITE_API_TOKEN = process.env.PATRONITE_API_KEY;

interface CacheItem {
  data: Set<string>;
  timestamp: number;
}

let cache: CacheItem | null = null;
const CACHE_DURATION = 60 * 1000; // 1 minute in milliseconds

// This function is only used internally
async function fetchPatronEmails(): Promise<Set<string>> {
  const url = `${PATRONITE_API_URL}patrons/active`;
  const headers = {
    Authorization: `token ${PATRONITE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    const response = await fetch(url, { headers });
    const data = await response.json();
    const emails = new Set(data.results.map((patron: any) => patron.email));

    // Add additional allowed emails
    emails.add("michalskibinski109@gmail.com");
    emails.add("d4nielp0l0k@gmail.com");

    return emails;
  } catch (error) {
    console.error("Error fetching patrons:", error);
    return new Set(["michalskibinski109@gmail.com"]);
  }
}

// Public function that only validates email
export async function isPatron(email: string): Promise<boolean> {
  if (!cache || Date.now() - cache.timestamp >= CACHE_DURATION) {
    cache = {
      data: await fetchPatronEmails(),
      timestamp: Date.now(),
    };
  }

  return cache.data.has(email.toLowerCase());
}
