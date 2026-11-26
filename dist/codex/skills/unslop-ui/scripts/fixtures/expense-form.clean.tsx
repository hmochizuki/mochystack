import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

export function ExpenseForm({ form, onSubmit, onDelete, onRestore, saveError, loading, user }) {
  async function handleDelete() {
    await onDelete();
    toast("経費を削除しました", { action: { label: "元に戻す", onClick: onRestore } });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">経費の申請</h1>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <input type="hidden" name="owner" value={user!.id} />
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>件名</FormLabel>
                <FormControl>
                  <Input placeholder="例：取引先との会食" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>金額（円）</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" aria-describedby="amount-error" {...field} />
                </FormControl>
                <FormMessage id="amount-error" />
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
                  <Textarea {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end gap-2 !mt-8">
            {!loading && <Button type="submit">申請</Button>}
          </div>
        </form>
      </Form>
      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          金額が上限の100,000円を超えています。100,000円以下にするか、事前申請の番号を入力してください。
        </p>
      )}
      <a href="/help/expense" className="text-sm underline">
        精算のルール
      </a>
      <p className="text-xs text-muted-foreground">規程の原文は https://example.com/rules にあります。</p>
      <Button variant="ghost" onClick={handleDelete}>
        削除
      </Button>
    </div>
  );
}
