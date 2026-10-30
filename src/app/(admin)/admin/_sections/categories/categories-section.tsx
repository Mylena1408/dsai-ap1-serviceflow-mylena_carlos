import type { CategoryRecord } from "@/modules/categories";
import { AdminCreateForm } from "../../create-form";
import { AdminRecordEditor } from "../../record-editor";
import { createCategoryAction, toggleCategoryAction, updateCategoryAction } from "./actions";

type CategoriesSectionProps = {
  section: "categories";
  categories: CategoryRecord[];
};

export function CategoriesSection({ section, categories }: CategoriesSectionProps) {
  return (
    <section className="admin-section" aria-labelledby="categories-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Catálogo</p>
            <h2 id="categories-heading">Categorias</h2>
            <p className="section-description">Agrupe serviços em categorias fáceis de encontrar.</p>
          </div>
        </div>
        <AdminCreateForm action={createCategoryAction} submitLabel="Criar categoria">
          <label>
            Nova categoria
            <input name="name" required maxLength={200} />
          </label>
        </AdminCreateForm>
        <ul className="entity-list">
          {categories.map((category) => (
            <AdminRecordEditor
              key={category.id}
              record={{ kind: "category", ...category }}
              section={section}
              toggleAction={toggleCategoryAction}
              updateAction={updateCategoryAction}
            />
          ))}
        </ul>
        </section>
  );
}
