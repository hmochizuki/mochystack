import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

export function ExpenseForm({ form, onSubmit, onDelete, failed }) {
  async function handleSave(values) {
    await onSubmit(values);
    toast.success("経費を保存しました！");
  }

  async function handleDelete() {
    if (!window.confirm("本当にこの経費を削除してもよろしいですか？")) return;
    await onDelete();
    toast.success("経費を削除しました");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-2xl font-bold text-transparent">
          経費の申請
        </h1>
        <p className="text-sm text-muted-foreground">経費の申請を作成できます。</p>
      </div>
      <Button variant="outline">
        <Sparkles className="mr-2 h-4 w-4" />
        AI で自動入力
      </Button>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSave)} className="space-y-4">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>件名</FormLabel>
                <FormControl>
                  <Input placeholder="件名を入力してください" {...field} />
                </FormControl>
                <FormDescription>この件名は承認者の一覧に表示されます。</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>金額</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" {...field} />
                </FormControl>
                <FormDescription>半角数字で入力してください。</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="memo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>メモ</FormLabel>
                <FormControl>
                  <Textarea placeholder="Enter で改行、Ctrl+Enter で送信" {...field} />
                </FormControl>
                <FormDescription>承認者が確認するときの参考になります。</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit">申請しましょう！🚀</Button>
        </form>
      </Form>
      <p className="text-xs">
        精算のルールは<a href="/help/expense">こちら</a>
      </p>
      {failed && <p role="alert">申し訳ありません。保存できませんでした。</p>}
      {failed && <p role="alert">エラーが発生しました。もう一度お試しください。</p>}
      <Button variant="ghost" onClick={handleDelete}>
        削除
      </Button>
    </div>
  );
}
