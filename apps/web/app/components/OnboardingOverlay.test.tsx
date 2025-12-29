import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnboardingOverlay } from "./OnboardingOverlay";

const STORAGE_KEY = "nightfall_onboarding_seen";

describe("OnboardingOverlay", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("visibility logic", () => {
    it("renders when localStorage key is not set", () => {
      render(<OnboardingOverlay />);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Welcome to Nightfall")).toBeInTheDocument();
    });

    it("does not render when localStorage key is set", () => {
      localStorage.setItem(STORAGE_KEY, "true");
      render(<OnboardingOverlay />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("sets localStorage when dismissed", async () => {
      render(<OnboardingOverlay />);
      const skipButton = screen.getByRole("button", { name: /skip/i });
      fireEvent.click(skipButton);

      await waitFor(() => {
        expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
      });
    });
  });

  describe("step navigation", () => {
    it("starts at step 1", () => {
      render(<OnboardingOverlay />);
      expect(screen.getByText("The Rust Spreads")).toBeInTheDocument();
    });

    it("advances to next step when Next is clicked", async () => {
      const user = userEvent.setup();
      render(<OnboardingOverlay />);

      await user.click(screen.getByRole("button", { name: /next/i }));
      expect(screen.getByText("Day & Night Cycle")).toBeInTheDocument();
    });

    it("goes back to previous step when Back is clicked", async () => {
      const user = userEvent.setup();
      render(<OnboardingOverlay />);

      // Go to step 2
      await user.click(screen.getByRole("button", { name: /next/i }));
      expect(screen.getByText("Day & Night Cycle")).toBeInTheDocument();

      // Go back to step 1
      await user.click(screen.getByRole("button", { name: /back/i }));
      expect(screen.getByText("The Rust Spreads")).toBeInTheDocument();
    });

    it("does not show Back button on first step", () => {
      render(<OnboardingOverlay />);
      expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
    });

    it("shows Start Playing on last step", async () => {
      const user = userEvent.setup();
      render(<OnboardingOverlay />);

      // Navigate to last step (5 steps total)
      for (let i = 0; i < 4; i++) {
        await user.click(screen.getByRole("button", { name: /next/i }));
      }

      expect(screen.getByRole("button", { name: /start playing/i })).toBeInTheDocument();
    });

    it("clicking step indicator changes step", async () => {
      const user = userEvent.setup();
      render(<OnboardingOverlay />);

      // Click on step 3 indicator
      const stepIndicators = screen.getAllByRole("tab");
      await user.click(stepIndicators[2]);

      expect(screen.getByText("Manage Resources")).toBeInTheDocument();
    });
  });

  describe("keyboard interactions", () => {
    it("closes when Escape key is pressed", async () => {
      render(<OnboardingOverlay />);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
      });
    });

    it("step indicators respond to Enter key", async () => {
      const user = userEvent.setup();
      render(<OnboardingOverlay />);

      const stepIndicators = screen.getAllByRole("tab");
      stepIndicators[2].focus();
      await user.keyboard("{Enter}");

      expect(screen.getByText("Manage Resources")).toBeInTheDocument();
    });

    it("step indicators respond to Space key", async () => {
      const user = userEvent.setup();
      render(<OnboardingOverlay />);

      const stepIndicators = screen.getAllByRole("tab");
      stepIndicators[3].focus();
      await user.keyboard(" ");

      expect(screen.getByText("Crew Efficiency")).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("has proper dialog role and aria attributes", () => {
      render(<OnboardingOverlay />);
      const dialog = screen.getByRole("dialog");

      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "onboarding-title");
      expect(dialog).toHaveAttribute("aria-describedby", "onboarding-description");
    });

    it("step indicators have proper aria attributes", () => {
      render(<OnboardingOverlay />);
      const tabs = screen.getAllByRole("tab");

      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(tabs[1]).toHaveAttribute("aria-selected", "false");
      expect(tabs[0]).toHaveAttribute("aria-label", "Step 1: The Rust Spreads");
    });

    it("close button has aria-label", () => {
      render(<OnboardingOverlay />);
      expect(screen.getByRole("button", { name: /close onboarding/i })).toBeInTheDocument();
    });
  });

  describe("localStorage error handling", () => {
    it("handles localStorage.getItem throwing an error", () => {
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = () => {
        throw new Error("SecurityError");
      };

      // Should not throw, and should show the overlay (fallback to not seen)
      expect(() => render(<OnboardingOverlay />)).not.toThrow();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      Storage.prototype.getItem = originalGetItem;
    });

    it("handles localStorage.setItem throwing an error", async () => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new Error("SecurityError");
      };

      render(<OnboardingOverlay />);
      const skipButton = screen.getByRole("button", { name: /skip/i });

      // Should not throw when dismissing
      expect(() => fireEvent.click(skipButton)).not.toThrow();

      Storage.prototype.setItem = originalSetItem;
    });
  });

  describe("cleanup", () => {
    it("removes event listener on unmount", () => {
      const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

      const { unmount } = render(<OnboardingOverlay />);
      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
      removeEventListenerSpy.mockRestore();
    });
  });
});
