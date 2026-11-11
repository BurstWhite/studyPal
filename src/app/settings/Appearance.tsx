import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { useTheme, type Theme } from "../theme";

const OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "白天", icon: Sun },
  { value: "dark", label: "晚上", icon: Moon },
];

export function Appearance() {
  const [theme, setTheme] = useTheme();
  return (
    <Card>
      <CardHeader>
        <CardTitle>外观</CardTitle>
        <CardDescription>
          选「跟随系统」时，会随 macOS 的浅色和深色外观自动切换。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="radiogroup"
          aria-label="外观"
          className="inline-flex rounded-lg border p-1"
        >
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={theme === option.value}
              onClick={() => setTheme(option.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                theme === option.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <option.icon className="size-4" />
              {option.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
