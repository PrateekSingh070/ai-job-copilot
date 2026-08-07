// Tab switcher extracted from DashboardPage. With five tabs the strip no longer
// fits on a phone, so buttons keep their intrinsic width and the row scrolls
// horizontally instead of squeezing every label into an unreadable column.
export function TabBar({ tabs, activeTab, onTabChange }) {
  return (
    <div className="mt-5 flex w-full gap-1 overflow-x-auto rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-1 shadow-lift sm:w-auto">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={`flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:px-6 ${
            activeTab === id
              ? "bg-gradient-to-r from-cyan-500 to-teal-500 text-zinc-950 shadow-md shadow-cyan-950/40"
              : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
          }`}
          onClick={() => onTabChange(id)}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}
