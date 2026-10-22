"use client"

/**
 * Tabs, over Radix.
 *
 * Radix supplies what a hand-rolled version gets wrong: the `tablist` / `tab` /
 * `tabpanel` roles and their links, arrow-key movement between tabs, and only
 * the selected tab in the Tab order. It comes from `radix-ui`, which the app
 * already depends on — no new package.
 *
 * ⓘ Underlined rather than pills, so a row of tabs inside a page does not read
 * as a second copy of the header's navigation.
 *
 * ⚠️ `overflow-y-hidden` beside `overflow-x-auto`, and no negative margin to
 * pull the underline onto the border. CSS turns the other axis to `auto` when
 * one is set, so a 1px overhang drew a vertical scrollbar on the tab row.
 */

import * as React from "react"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "flex items-end gap-1 overflow-x-auto overflow-y-hidden border-b border-[var(--border-subtle)]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:border-foreground data-[state=active]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
