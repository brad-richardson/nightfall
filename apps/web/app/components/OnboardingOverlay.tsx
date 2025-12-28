"use client";

import { useState, useEffect } from "react";

const ONBOARDING_STORAGE_KEY = "nightfall_onboarding_seen";

type Step = {
  title: string;
  description: string;
  icon: string;
};

const STEPS: Step[] = [
  {
    title: "The Rust Spreads",
    description: "A creeping decay threatens the city's infrastructure. Roads and buildings deteriorate faster when night falls. Work together to hold it back.",
    icon: "🌑"
  },
  {
    title: "Day & Night Cycle",
    description: "The world follows a 20-minute cycle. During the day, decay slows. At night, The Rust accelerates. Watch the phase indicator to track time.",
    icon: "🌅"
  },
  {
    title: "Manage Resources",
    description: "Buildings generate Food, Equipment, Energy, and Materials. These resources flow to your region's hub and fund repair operations.",
    icon: "📦"
  },
  {
    title: "Vote on Priorities",
    description: "Repair crews tackle degraded roads automatically. Use the Operations Queue to upvote or downvote tasks—your votes influence what gets fixed first.",
    icon: "🗳️"
  },
  {
    title: "Contribute & Repair",
    description: "Click buildings on the map to contribute resources directly. Every contribution helps crews complete repairs faster.",
    icon: "🔧"
  }
];

export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!seen) {
      setVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
      setVisible(false);
    }, 300);
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      handleDismiss();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  };

  const handleSkip = () => {
    handleDismiss();
  };

  if (!visible) return null;

  const step = STEPS[currentStep];
  const isLastStep = currentStep === STEPS.length - 1;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${
        exiting ? "opacity-0" : "opacity-100"
      }`}
    >
      <div
        className={`relative mx-4 w-full max-w-md rounded-3xl border border-white/10 bg-gradient-to-b from-[#1a1d21] to-[#0f1216] p-8 shadow-[0_24px_60px_rgba(0,0,0,0.6)] transition-all duration-300 ${
          exiting ? "scale-95 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        {/* Header */}
        <div className="mb-6 text-center">
          <p className="text-[10px] uppercase tracking-[0.5em] text-[color:var(--night-teal)]">
            How to Play
          </p>
          <h2 className="mt-2 font-display text-2xl text-white">
            Welcome to Nightfall
          </h2>
          <p className="mt-1 text-xs text-white/50">
            The nights are getting longer.
          </p>
        </div>

        {/* Step content */}
        <div className="mb-8">
          <div className="mb-4 flex justify-center text-5xl">{step.icon}</div>
          <h3 className="text-center text-lg font-semibold text-white">
            {step.title}
          </h3>
          <p className="mt-3 text-center text-sm leading-relaxed text-white/70">
            {step.description}
          </p>
        </div>

        {/* Step indicators */}
        <div className="mb-6 flex justify-center gap-2">
          {STEPS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentStep(idx)}
              className={`h-2 rounded-full transition-all ${
                idx === currentStep
                  ? "w-6 bg-[color:var(--night-teal)]"
                  : "w-2 bg-white/20 hover:bg-white/40"
              }`}
              aria-label={`Go to step ${idx + 1}`}
            />
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={handleSkip}
            className="rounded-xl px-4 py-2 text-xs font-medium uppercase tracking-wider text-white/50 transition hover:text-white/80"
          >
            Skip
          </button>
          <div className="flex gap-3">
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white/80 transition hover:border-white/20 hover:bg-white/10"
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="rounded-xl bg-[color:var(--night-teal)] px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white shadow-[0_4px_16px_rgba(45,212,191,0.3)] transition hover:brightness-110"
            >
              {isLastStep ? "Start Playing" : "Next"}
            </button>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white/80"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
