import { computed, type Ref } from "vue"

export function useAiPromptSuggestions(destination: Ref<string>, hasActivities: Ref<boolean>) {
  const emptyDaySuggestions = computed(() => [
    `Plan my full day in ${destination.value}`,
    "Find breakfast, lunch, and dinner spots",
    "Mix cultural sites with food stops",
    "Suggest hidden gems and local favorites",
  ])

  const withActivitiesSuggestions = [
    "Is this day too packed?",
    "How long from my hotel to the first stop?",
    "Review this day for timing problems",
    "Review the whole trip for issues",
    "Add a coffee shop nearby",
    "Move dinner to 7 PM",
    "Optimize the route",
    "Fill the gaps",
  ]

  const suggestions = computed(() =>
    hasActivities.value ? withActivitiesSuggestions : emptyDaySuggestions.value,
  )

  return { suggestions }
}
