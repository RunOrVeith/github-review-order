<script lang="ts">
  import { loadSettings, SETTINGS, settingValue, type NumberSetting, type ToggleSetting } from '@/utils/settings';

  // Open tabs follow the stored values, so writing them is all a control has to do
  let values = $state<Awaited<ReturnType<typeof loadSettings>> | null>(null);
  void loadSettings().then((loaded) => (values = loaded));

  function toggle(setting: ToggleSetting, event: Event) {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    values![setting.key] = checked;
    void setting.item.setValue(checked);
  }

  function setNumber(setting: NumberSetting, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    // Out of range or empty snaps back to what's allowed, and the field shows what's used
    const value = settingValue(setting, input.valueAsNumber);
    input.valueAsNumber = value;
    values![setting.key] = value;
    void setting.item.setValue(value);
  }
</script>

<section aria-labelledby="settings-heading">
  <h2 id="settings-heading">Settings</h2>
  {#if values}
    <ul>
      {#each SETTINGS as setting (setting.key)}
        <li>
          <label>
            <input
              type="checkbox"
              checked={values[setting.key]}
              onchange={(event) => toggle(setting, event)}
              aria-describedby={`setting-${setting.key}`}
            />
            {setting.label}
          </label>
          <p id={`setting-${setting.key}`} class="hint">{setting.hint}</p>
          {#if setting.children}
            <ul class="children">
              {#each setting.children as child (child.key)}
                <!-- Only matters while the setting it belongs to is on -->
                <li class={{ off: !values[setting.key] }}>
                  <label>
                    {child.label}
                    <input
                      type="number"
                      min={child.min}
                      max={child.max}
                      step="1"
                      value={values[child.key]}
                      disabled={!values[setting.key]}
                      onchange={(event) => setNumber(child, event)}
                      aria-describedby={`setting-${child.key}`}
                    />
                  </label>
                  <p id={`setting-${child.key}`} class="hint">{child.hint}</p>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  h2 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li + li {
    margin-top: 6px;
  }

  label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  input[type='checkbox'] {
    margin: 0;
    accent-color: var(--accent);
  }

  input[type='number'] {
    width: 4em;
    padding: 1px 4px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }

  .hint {
    margin: 0 0 0 19px;
    color: var(--muted);
    font-size: 12px;
  }

  /* Indented under the checkbox's label, so it reads as part of that setting */
  .children {
    margin: 6px 0 0 19px;
    padding-left: 10px;
    border-left: 2px solid var(--border);
  }

  .children .hint {
    margin-left: 0;
  }

  .off {
    opacity: 0.55;
  }

  .off label {
    cursor: default;
  }
</style>
