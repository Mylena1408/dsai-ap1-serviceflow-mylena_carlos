import Link from "next/link";
import { searchPageHref, type SearchParams } from "./request-search-url";

type RequestPaginationProps = {
  basePath: string;
  params: SearchParams;
  page: number;
  pageCount: number;
  total: number;
};

// "Página X de Y — N solicitações" with previous and next links that keep the criteria
// (SPEC 2026-10-31-busca-filtros-paginacao, section 5.5).
export function RequestPagination({ basePath, params, page, pageCount, total }: RequestPaginationProps) {
  return (
    <nav className="pagination" aria-label="Páginas da lista">
      {page > 1 ? (
        <Link href={searchPageHref(basePath, params, page - 1)} rel="prev">
          Anterior
        </Link>
      ) : (
        <span aria-hidden="true" className="pagination-disabled">Anterior</span>
      )}
      <p>
        Página {page} de {pageCount} — {total === 1 ? "1 solicitação" : `${total} solicitações`}
      </p>
      {page < pageCount ? (
        <Link href={searchPageHref(basePath, params, page + 1)} rel="next">
          Próxima
        </Link>
      ) : (
        <span aria-hidden="true" className="pagination-disabled">Próxima</span>
      )}
    </nav>
  );
}
