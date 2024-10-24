import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { Card, CardContent } from "@/components/ui/card";
import { ThumbsDown, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface FeedbackItem {
  id: string;
  reason: string | null;
  context: any[];
  created_at: string;
}

export function FeedbackHistory() {
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>(
    {}
  );
  const supabase = createClientComponentClient();

  useEffect(() => {
    const fetchFeedbacks = async () => {
      try {
        const { data: feedbackData, error } = await supabase
          .from("feedback")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;
        setFeedbacks(feedbackData || []);
      } catch (error) {
        console.error("Error fetching feedbacks:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchFeedbacks();
  }, [supabase]);

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  if (loading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (feedbacks.length === 0) {
    return (
      <div className="text-center text-muted-foreground p-4">
        Nie zgłoszono jeszcze żadnych uwag do odpowiedzi asystenta.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      {feedbacks.map((feedback) => (
        <Card
          key={feedback.id}
          className="bg-muted/50 hover:bg-muted/80 transition-colors"
        >
          <CardContent className="p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
              <div className="flex items-center sm:block">
                <div className="bg-background rounded-full p-2 shadow-sm">
                  <ThumbsDown className="h-4 w-4 text-primary" />
                </div>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-2">
                  <div className="space-y-1 flex-1">
                    {feedback.reason ? (
                      <p className="font-medium text-sm text-foreground break-words">
                        {feedback.reason}
                      </p>
                    ) : (
                      <p className="text-muted-foreground text-sm italic">
                        Nie podano powodu
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(feedback.created_at), {
                        addSuffix: true,
                        locale: pl,
                      })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => toggleExpand(feedback.id)}
                  >
                    {expandedItems[feedback.id] ? (
                      <span className="flex items-center gap-2">
                        Zwiń
                        <ChevronUp className="h-4 w-4" />
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        Rozwiń konwersację
                        <ChevronDown className="h-4 w-4" />
                      </span>
                    )}
                  </Button>
                </div>
                {expandedItems[feedback.id] && (
                  <div className="space-y-2 pt-2">
                    {feedback.context.map((msg, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          "text-sm p-2 sm:p-3 rounded-md border shadow-sm overflow-hidden",
                          msg.role === "assistant"
                            ? "bg-background text-foreground"
                            : "bg-primary/10 text-foreground"
                        )}
                      >
                        <p className="text-xs text-muted-foreground mb-1">
                          {msg.role === "assistant" ? "Asystent" : "Użytkownik"}
                          :
                        </p>
                        <p className="break-words whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
