import type { App } from 'vue';
import AutoComplete from 'primevue/autocomplete';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Column from 'primevue/column';
import ConfirmDialog from 'primevue/confirmdialog';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import Drawer from 'primevue/drawer';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Password from 'primevue/password';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import Toast from 'primevue/toast';
import ToggleSwitch from 'primevue/toggleswitch';

/** PrimeVue components used everywhere, registered once. */
export function registerComponents(app: App) {
  const list = {
    AutoComplete, Button, Checkbox, Column, ConfirmDialog, DataTable, DatePicker, Dialog, Drawer,
    IconField, InputIcon, InputNumber, InputText, Message, MultiSelect, Password, Select, SelectButton,
    Tag, Textarea, Toast, ToggleSwitch,
  };
  for (const [name, c] of Object.entries(list)) app.component(name, c);
}
