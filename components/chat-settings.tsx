import { Zap } from "lucide-react";
import { useChatStore } from "@/lib/store";

const ChatSettings = (_props: { isPatron: boolean }) => {
  const model = useChatStore((state) => state.models[0]);

  return (
    <div className="space-y-3 pt-8">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Zap className="h-4 w-4" />
        Model
      </div>
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <div className="font-medium">{model.short}</div>
        <div className="text-xs text-muted-foreground">
          Jedyny model · thinking wyłączone · bez narzędzi
        </div>
      </div>
    </div>
  );
};

export default ChatSettings;
