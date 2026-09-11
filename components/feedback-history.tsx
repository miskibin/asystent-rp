"use client";

import { useEffect, useState } from "react";
import { createClientComponentClient } from "@/lib/supabase/client";
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

export default function FeedbackHistory() {
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
      <div className="flex justify-center p-2">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (feedbacks.length === 0) {
    return (
      <div className="text-center text-muted-foreground p-2 text-sm">
        Nie zgłoszono jeszcze żadnych uwag do odpowiedzi asystenta.
      </div>
    );
  }

  return (
    <div className="space-y-2 px-0 py-2 sm:space-y-3 sm:p-4">
      {feedbacks.map((feedback) => (
        <Card
          key={feedback.id}
          className="bg-muted/50 hover:bg-muted/80 transition-colors"
        >
          <CardContent className="p-2 sm:p-3">
            <div className="flex gap-2 sm:gap-3">
              <div className="shrink-0"></div>
              <div className="min-w-0 flex-1 space-y-1 sm:space-y-2">
                <div className="flex flex-col gap-1">
                  <div className="space-y-1">
                    {feedback.reason ? (
                      <p className="font-medium text-xs sm:text-sm text-foreground break-words">
                        {feedback.reason}
                      </p>
                    ) : (
                      <p className="text-muted-foreground text-xs sm:text-sm italic">
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
                    className="w-full justify-between text-xs sm:text-sm py-1 h-auto"
                    onClick={() => toggleExpand(feedback.id)}
                  >
                    <span className="truncate">
                      {expandedItems[feedback.id]
                        ? "Zwiń"
                        : "Rozwiń konwersację"}
                    </span>
                    {expandedItems[feedback.id] ? (
                      <ChevronUp className="h-3 w-3 sm:h-4 sm:w-4 ml-2 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4 ml-2 flex-shrink-0" />
                    )}
                  </Button>
                </div>
                {expandedItems[feedback.id] && (
                  <div className="space-y-2">
                    {feedback.context.map((msg, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          "text-xs sm:text-sm p-1.5 sm:p-2 rounded-md border shadow-sm",
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
