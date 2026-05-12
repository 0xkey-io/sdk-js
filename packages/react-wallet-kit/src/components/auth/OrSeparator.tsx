export function OrSeparator() {
  return (
    <div className="my-3 flex w-full flex-row items-center justify-center">
      <div className="flex h-[1px] flex-grow bg-icon-text-light/15 dark:bg-icon-text-dark/15" />
      <span className="mx-2 text-xs text-icon-text-light/50 dark:text-icon-text-dark/50">
        or
      </span>
      <div className="flex h-[1px] flex-grow bg-icon-text-light/15 dark:bg-icon-text-dark/15" />
    </div>
  );
}
