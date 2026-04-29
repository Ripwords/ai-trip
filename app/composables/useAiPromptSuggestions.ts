import { computed, type Ref } from "vue"

export function useAiPromptSuggestions(destination: Ref<string>, hasActivities: Ref<boolean>) {
  const emptyDaySuggestions = computed(() => [
    `Plan my full day in ${destination.value}`,
    "Find breakfast, lunch, and dinner spots",
    "Mix cultural sites with food stops",
    "Suggest hidden gems and local favorites",
  ])

  const withActivitiesSuggestions = [
    "Add a coffee shop nearby",
    "Move dinner to 7 PM",
    "Remove the museum",
    "Optimize the route",
    "Fill the gaps",
    "Find a hotel nearby",
  ]

  const suggestions = computed(() =>
    hasActivities.value ? withActivitiesSuggestions : emptyDaySuggestions.value,
  )

  return { suggestions }
}
