import { Component, type ReactNode } from "react";

/** Shows a retry screen instead of a blank page when a game fails to load or crashes. */
export class Boundary extends Component<{ children: ReactNode; back?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="notice">
        <h1>This game didn't load</h1>
        <p>Check your connection and try again.</p>
        <p>
          <a href="#" onClick={(e) => { e.preventDefault(); location.reload(); }}>Try again</a>
          {" · "}
          <a href={this.props.back ?? "#/"}>All games</a>
        </p>
      </main>
    );
  }
}
