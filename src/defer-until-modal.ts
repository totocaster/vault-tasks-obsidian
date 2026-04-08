import { Modal, Notice, Setting } from "obsidian";
import { getTomorrowDateString, isFutureDate } from "./logic";

export class DeferUntilModal extends Modal {
	private dateInputEl: HTMLInputElement | null = null;
	private readonly minimumDate = getTomorrowDateString();

	constructor(
		app: Modal["app"],
		private readonly noteTitle: string,
		private readonly currentDeferredUntil: string | null,
		private readonly onSubmitDate: (deferredUntil: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Defer until");

		new Setting(this.contentEl)
			.setName(this.noteTitle)
			.setDesc("Pending tasks from this note stay hidden until this date.")
			.addText((component) => {
				component.inputEl.type = "date";
				component.inputEl.min = this.minimumDate;
				component.setValue(this.getInitialDateValue());
				this.dateInputEl = component.inputEl;

				component.inputEl.addEventListener("keydown", (event) => {
					if (event.key !== "Enter") {
						return;
					}

					event.preventDefault();
					void this.submit();
				});
			});

		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				});
			})
			.addButton((button) => {
				button.setButtonText("Save").setCta().onClick(() => {
					void this.submit();
				});
			});

		this.dateInputEl?.focus();
		window.setTimeout(() => {
			const dateInputEl = this.dateInputEl as (HTMLInputElement & {
				showPicker?: () => void;
			}) | null;
			try {
				dateInputEl?.showPicker?.();
			} catch {
				// Ignore unsupported or blocked picker calls.
			}
		}, 0);
	}

	private getInitialDateValue(): string {
		if (this.currentDeferredUntil && this.currentDeferredUntil >= this.minimumDate) {
			return this.currentDeferredUntil;
		}

		return this.minimumDate;
	}

	private async submit(): Promise<void> {
		const deferredUntil = this.dateInputEl?.value ?? "";

		if (!isFutureDate(deferredUntil)) {
			new Notice("Choose a future date.");
			return;
		}

		await this.onSubmitDate(deferredUntil);
		this.close();
	}
}
