import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { clearAccessToken } from "./lib/api";
import { AuthProvider } from "./providers/AuthProvider";

const { getMock, postMock, patchMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  patchMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("./lib/api", () => {
  let token = null;
  return {
    api: {
      get: getMock,
      post: postMock,
      patch: patchMock,
      delete: deleteMock,
    },
    getAccessToken: () => token,
    setAccessToken: (next) => {
      token = next ?? null;
    },
    clearAccessToken: () => {
      token = null;
    },
  };
});

function renderApp() {
  const queryClient = new QueryClient();
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Frontend auth + job tracker flow", () => {
  beforeEach(() => {
    // The access token is a module-level variable, so it outlives a render.
    clearAccessToken();
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();

    getMock.mockImplementation((url) => {
      if (url === "/jobs") {
        return Promise.resolve({
          data: {
            success: true,
            data: [
              {
                id: "j1",
                company: "Acme",
                role: "Full Stack Intern",
                status: "APPLIED",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            meta: { page: 1, pageSize: 20, total: 1 },
          },
        });
      }
      if (url === "/jobs/metrics/summary") {
        return Promise.resolve({
          data: {
            data: {
              totalApplications: 1,
              stageDistribution: { APPLIED: 1 },
              interviewRate: 0,
              offerRate: 0,
            },
          },
        });
      }
      return Promise.resolve({ data: { data: {} } });
    });

    postMock.mockImplementation((url) => {
      // No refresh cookie in a fresh browser, so the boot-time silent refresh
      // fails and the app starts logged out.
      if (url === "/auth/refresh") {
        return Promise.reject(new Error("no refresh cookie"));
      }
      if (url === "/auth/login") {
        return Promise.resolve({
          data: {
            data: {
              accessToken: "token-1",
              user: { id: "u1", name: "Demo", email: "demo@copilot.local" },
            },
          },
        });
      }
      return Promise.resolve({ data: { data: {} } });
    });
  });

  it("logs in and lands on the dashboard", async () => {
    renderApp();

    fireEvent.click(screen.getByTestId("login-submit"));

    expect(
      await screen.findByRole("heading", { name: /application dashboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("logout-button")).toHaveTextContent(/sign out/i);
  });

  it("creates a job from the dashboard form", async () => {
    renderApp();

    fireEvent.click(screen.getByTestId("login-submit"));
    await screen.findByTestId("add-job-company");

    fireEvent.change(screen.getByTestId("add-job-company"), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByTestId("add-job-role"), {
      target: { value: "Full Stack Intern" },
    });
    fireEvent.click(screen.getByTestId("add-job-submit"));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/jobs", {
        company: "Acme",
        role: "Full Stack Intern",
        status: "APPLIED",
      }),
    );
  });

  it("renders jobs on the kanban board and can delete one", async () => {
    renderApp();

    fireEvent.click(screen.getByTestId("login-submit"));

    const card = await screen.findByTestId("job-card");
    expect(card).toHaveTextContent("Acme");
    expect(screen.getByTestId("column-APPLIED")).toContainElement(card);

    fireEvent.click(screen.getByRole("button", { name: /delete acme/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/jobs/j1"));
  });

  it("switches to the resume tailor tab and calls the AI endpoint", async () => {
    renderApp();

    fireEvent.click(screen.getByTestId("login-submit"));
    await screen.findByTestId("add-job-company");

    fireEvent.click(screen.getByRole("button", { name: /resume tailor/i }));

    fireEvent.change(screen.getByTestId("tailor-role"), {
      target: { value: "Full Stack Engineer" },
    });
    fireEvent.change(screen.getByTestId("tailor-resume"), {
      target: { value: "a".repeat(60) },
    });
    fireEvent.change(screen.getByTestId("tailor-jd"), {
      target: { value: "b".repeat(60) },
    });
    fireEvent.click(screen.getByTestId("tailor-submit"));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/ai/resume-tailor",
        expect.objectContaining({ targetRole: "Full Stack Engineer" }),
      ),
    );
  });
});
