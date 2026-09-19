export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="p-6 text-center">
      <p className="text-sm text-rose-600 font-medium">Failed to load data</p>
      <p className="text-xs text-muted-foreground mt-1">{message}</p>
    </div>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
