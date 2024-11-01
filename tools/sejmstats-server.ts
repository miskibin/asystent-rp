"use server";

interface ActResponse {
    ELI: string; 
    url: string;
    publisher: string;
    status: string; 
    title: string; 
    releasedBy: string;
    announcementDate: string;
    summary: string;
    text_length: number;
}

class SejmStatsCommunicator {
    private static readonly SEJM_STATS_BASE_URL = "https://sejm-stats.pl/apiInt";

    async search(searchQuery: string): Promise<ActResponse[]> {
        console.debug("Search function started");
        const url = new URL(
            `${SejmStatsCommunicator.SEJM_STATS_BASE_URL}/vector-search`
        );
        url.searchParams.append("q", searchQuery);
        url.searchParams.append("n", "3");

        try {
            const response = await fetch(url.toString());
            if (!response.ok) {
                const responseText = await response.text();
                console.error(`HTTP error! status: ${response.status}`);
                console.error(`Response text: ${responseText}`);
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.debug("Received search data");
            return data;
        } catch (error) {
            console.error(`Error in search function:`, error);
            throw error;
        }
    }

    optimizeForLLM(acts: ActResponse[]): ActResponse[] {
        return acts.map(act => ({
            ...act,
            announcementDate: new Date(act.announcementDate).toISOString()
        }));
    }

    async searchOptimized(searchQuery: string): Promise<ActResponse[]> {
        const data = await this.search(searchQuery);
        return this.optimizeForLLM(data);
    }
}

export const searchOptimized = async (searchQuery: string): Promise<ActResponse[]> => {
    console.debug("searchOptimized function started");
    const communicator = new SejmStatsCommunicator();
    try {
        const result = await communicator.searchOptimized(searchQuery);
        console.debug("searchOptimized completed successfully");
        return result;
    } catch (error) {
        console.error(`Error in searchOptimized:`, error);
        throw error;
    }
};